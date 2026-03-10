registerGame("tron", "🏍️ Tron", "WASD = P1, Arrows = P2", "Last trail standing", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a0a");
    this.gfx=this.add.graphics(); this.grid=new Set();
    this.p=[{x:200,y:H/2,dx:2,dy:0,color:0xf7c948,alive:true},{x:W-200,y:H/2,dx:-2,dy:0,color:0xe94560,alive:true}];
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.add.text(W/2,16,"TRON — WASD vs Arrows",{fontSize:"16px",color:"#555",fontFamily:"monospace"}).setOrigin(0.5);
  }
  update() {
    const p=this.p,k=this.k;
    if(k.w.isDown&&!p[0].dy){p[0].dx=0;p[0].dy=-2;} if(k.s.isDown&&!p[0].dy){p[0].dx=0;p[0].dy=2;}
    if(k.a.isDown&&!p[0].dx){p[0].dy=0;p[0].dx=-2;} if(k.d.isDown&&!p[0].dx){p[0].dy=0;p[0].dx=2;}
    if(k.up.isDown&&!p[1].dy){p[1].dx=0;p[1].dy=-2;} if(k.down.isDown&&!p[1].dy){p[1].dx=0;p[1].dy=2;}
    if(k.left.isDown&&!p[1].dx){p[1].dy=0;p[1].dx=-2;} if(k.right.isDown&&!p[1].dx){p[1].dy=0;p[1].dx=2;}
    for(let i=0;i<2;i++){if(!p[i].alive)continue;p[i].x+=p[i].dx;p[i].y+=p[i].dy;
      const key=Math.round(p[i].x)+","+Math.round(p[i].y);
      if(p[i].x<0||p[i].x>W||p[i].y<0||p[i].y>H||this.grid.has(key)){p[i].alive=false;this.add.text(W/2,H/2+(i*30-15),"Player "+(i+1)+" crashed!",{fontSize:"20px",color:i===0?"#f7c948":"#e94560",fontFamily:"monospace"}).setOrigin(0.5);continue;}
      this.grid.add(key);this.gfx.fillStyle(p[i].color,1);this.gfx.fillRect(p[i].x-1,p[i].y-1,3,3);}
  }
});
