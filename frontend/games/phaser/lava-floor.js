registerGame("lava-floor", "🌋 Lava Floor", "A/D+W = P1, ←/→+↑ = P2", "Platforms disappear — don't fall!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2e0a0a");
    this.lava=this.add.rectangle(W/2,H-10,W,20,0xff3300);
    this.plats=this.physics.add.staticGroup();
    this.platList=[];
    for(let r=0;r<5;r++)for(let c=0;c<6;c++){
      const x=80+c*120,y=80+r*80;
      const p=this.add.rectangle(x,y,90,14,0x666666);this.plats.add(p);this.platList.push(p);
    }
    this.p1=this.add.rectangle(140,40,18,24,0xf7c948);this.p2=this.add.rectangle(W-140,40,18,24,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setGravityY(600);});
    this.physics.add.collider(this.p1,this.plats);this.physics.add.collider(this.p2,this.plats);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",w:"W",left:"LEFT",right:"RIGHT",up:"UP"});
    this.over=false;
    // Remove platforms over time
    this.time.addEvent({delay:2000,callback:()=>{
      const active=this.platList.filter(p=>p.active);
      if(active.length>2){const idx=Phaser.Math.Between(0,active.length-1);active[idx].destroy();}
    },loop:true});
  }
  update(){if(this.over)return;const k=this.k;
    this.p1.body.setVelocityX(k.a.isDown?-220:k.d.isDown?220:0);
    if(k.w.isDown&&this.p1.body.touching.down)this.p1.body.setVelocityY(-450);
    this.p2.body.setVelocityX(k.left.isDown?-220:k.right.isDown?220:0);
    if(k.up.isDown&&this.p2.body.touching.down)this.p2.body.setVelocityY(-450);
    if(this.p1.y>H-25&&!this.over){this.over=true;this.add.text(W/2,H/2,"P2 WINS!",{fontSize:"40px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}
    if(this.p2.y>H-25&&!this.over){this.over=true;this.add.text(W/2,H/2,"P1 WINS!",{fontSize:"40px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
