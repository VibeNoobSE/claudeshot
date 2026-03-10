registerGame("frogger", "🐸 Frogger", "WASD = P1, Arrows = P2", "Race to cross the road first!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.add.rectangle(W/2,20,W,40,0x4ecca3); // finish
    this.add.text(W/2,20,"FINISH",{fontSize:"14px",color:"#1a1a2e",fontFamily:"monospace"}).setOrigin(0.5);
    this.add.rectangle(W/2,H-20,W,40,0x4ecca3); // start
    this.cars=this.physics.add.group();
    this.lanes=[{y:100,sp:120},{y:160,sp:-160},{y:220,sp:200},{y:280,sp:-140},{y:340,sp:180},{y:400,sp:-220}];
    this.lanes.forEach(l=>{this.add.rectangle(W/2,l.y,W,40,0x333344);
      for(let i=0;i<4;i++){const c=this.add.rectangle(Phaser.Math.Between(0,W),l.y,60,20,l.sp>0?0xcc4444:0x4444cc);this.cars.add(c);this.physics.add.existing(c);c.body.setVelocityX(l.sp);c.body.setImmovable(true);c.setData("sp",l.sp);}});
    this.p1=this.add.rectangle(W/3,H-20,16,16,0xf7c948);this.p2=this.add.rectangle(W*2/3,H-20,16,16,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true);});
    this.physics.add.overlap(this.p1,this.cars,()=>{this.p1.setPosition(W/3,H-20);});
    this.physics.add.overlap(this.p2,this.cars,()=>{this.p2.setPosition(W*2/3,H-20);});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.over=false;
  }
  update(){
    if(this.over)return;
    this.cars.getChildren().forEach(c=>{if(c.x<-40)c.x=W+30;if(c.x>W+40)c.x=-30;});
    this.p1.body.setVelocity(0);this.p2.body.setVelocity(0);const s=200,k=this.k;
    if(k.a.isDown)this.p1.body.setVelocityX(-s);if(k.d.isDown)this.p1.body.setVelocityX(s);
    if(k.w.isDown)this.p1.body.setVelocityY(-s);if(k.s.isDown)this.p1.body.setVelocityY(s);
    if(k.left.isDown)this.p2.body.setVelocityX(-s);if(k.right.isDown)this.p2.body.setVelocityX(s);
    if(k.up.isDown)this.p2.body.setVelocityY(-s);if(k.down.isDown)this.p2.body.setVelocityY(s);
    if(this.p1.y<40){this.over=true;this.add.text(W/2,H/2,"P1 WINS!",{fontSize:"40px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}
    if(this.p2.y<40){this.over=true;this.add.text(W/2,H/2,"P2 WINS!",{fontSize:"40px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
